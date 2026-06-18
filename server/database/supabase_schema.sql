-- BarangayHiram Supabase/Postgres schema.
-- Run this in the Supabase SQL editor after Supabase Auth is enabled.
-- Inventory rule:
--   - Do not reduce equipment.available_quantity when a request is submitted.
--   - Do not reduce equipment.available_quantity when a request is approved.
--   - Reduce equipment.available_quantity only during staff release.
--   - Increase equipment.available_quantity only when staff receives returned equipment.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  contact_number text,
  address text,
  role text NOT NULL DEFAULT 'borrower'
    CHECK (role IN ('super_admin', 'staff', 'borrower')),
  borrower_type text
    CHECK (borrower_type IS NULL OR borrower_type IN ('Resident', 'Student', 'Transient')),
  account_status text NOT NULL DEFAULT 'Pending'
    CHECK (account_status IN ('Pending', 'Approved', 'Rejected', 'Active', 'Inactive')),
  verification_document_url text,
  admin_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code text UNIQUE,
  name text NOT NULL,
  category text NOT NULL
    CHECK (category IN ('Chairs', 'Tables', 'Tents', 'Sound Systems', 'Projectors', 'Generators', 'Sports Equipment', 'Others')),
  description text,
  total_quantity int NOT NULL DEFAULT 0
    CHECK (total_quantity >= 0),
  available_quantity int NOT NULL DEFAULT 0
    CHECK (available_quantity >= 0),
  condition text,
  location text,
  status text,
  is_high_value boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_quantity <= total_quantity)
);

CREATE TABLE IF NOT EXISTS public.borrowing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  borrower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  quantity int NOT NULL
    CHECK (quantity > 0),
  borrow_date date NOT NULL,
  expected_return_date date NOT NULL,
  purpose text NOT NULL,
  event_location text NOT NULL,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN (
      'Pending',
      'Approved',
      'Rejected',
      'Ready for Release',
      'Released',
      'Returned',
      'Overdue',
      'Cancelled'
    )),
  admin_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_return_date >= borrow_date)
);

CREATE TABLE IF NOT EXISTS public.releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.borrowing_requests(id) ON DELETE RESTRICT,
  released_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  released_at timestamptz NOT NULL DEFAULT now(),
  release_notes text
);

CREATE TABLE IF NOT EXISTS public.returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.borrowing_requests(id) ON DELETE RESTRICT,
  received_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  returned_at timestamptz NOT NULL DEFAULT now(),
  returned_quantity int NOT NULL
    CHECK (returned_quantity > 0),
  return_condition text NOT NULL
    CHECK (return_condition IN ('Good Condition', 'Damaged', 'Incomplete')),
  penalty_notes text
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_status
  ON public.profiles(role, account_status);

CREATE INDEX IF NOT EXISTS idx_profiles_borrower_type
  ON public.profiles(borrower_type);

CREATE INDEX IF NOT EXISTS idx_equipment_category_status
  ON public.equipment(category, status);

CREATE INDEX IF NOT EXISTS idx_borrowing_requests_borrower
  ON public.borrowing_requests(borrower_id);

CREATE INDEX IF NOT EXISTS idx_borrowing_requests_equipment_dates
  ON public.borrowing_requests(equipment_id, borrow_date, expected_return_date);

CREATE INDEX IF NOT EXISTS idx_borrowing_requests_status
  ON public.borrowing_requests(status);

CREATE INDEX IF NOT EXISTS idx_releases_request
  ON public.releases(request_id);

CREATE INDEX IF NOT EXISTS idx_returns_request
  ON public.returns(request_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON public.audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_record
  ON public.audit_logs(table_name, record_id);

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_equipment_updated_at ON public.equipment;
CREATE TRIGGER set_equipment_updated_at
BEFORE UPDATE ON public.equipment
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_borrowing_requests_updated_at ON public.borrowing_requests;
CREATE TRIGGER set_borrowing_requests_updated_at
BEFORE UPDATE ON public.borrowing_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
