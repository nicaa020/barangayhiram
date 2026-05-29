# BarangayHiram

BarangayHiram is a Barangay Equipment Lending System for managing equipment, borrowers, borrowing transactions, returns, staff accounts, reports, and dashboard activity.

## Requirements

Before running the project, install:

- Git: https://git-scm.com/
- Node.js: https://nodejs.org/

To check if they are installed, open Command Prompt, PowerShell, or Git Bash and run:

```bash
git --version
node --version
npm --version
```

## Download From GitHub

### Option 1: Clone using Git

1. Open the GitHub repository for BarangayHiram.
2. Click the green **Code** button.
3. Copy the HTTPS repository link.
4. Open Command Prompt, PowerShell, or Git Bash.
5. Go to the folder where you want to save the project:

```bash
cd Documents
```

6. Clone the project:

```bash
git clone https://github.com/USERNAME/barangayhiram.git
```

Replace `USERNAME` with the correct GitHub username or organization name.

7. Open the project folder:

```bash
cd barangayhiram
```

### Option 2: Download ZIP

1. Open the GitHub repository for BarangayHiram.
2. Click the green **Code** button.
3. Click **Download ZIP**.
4. Extract the ZIP file.
5. Open the extracted `barangayhiram` folder.

## Setup

1. Install the project dependencies:

```bash
npm install
```

2. Create a `.env` file by copying `.env.example`.

On Windows PowerShell:

```bash
Copy-Item .env.example .env
```

On Command Prompt:

```bash
copy .env.example .env
```

3. Open the `.env` file and check the values:

```env
PORT=3000
JWT_SECRET=change_this_to_a_long_random_secret
DB_PATH=./barangayhiram.db
```

For group testing, the default values are okay. For real use, change `JWT_SECRET` to a longer private value.

## Run The Project

Start the server:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

Then open this link in a browser:

```text
http://localhost:3000
```

The app will redirect to the login page.

## Default Login

If the database has no users yet, the system creates a default admin account:

```text
Username: admin
Password: admin123
```

Change this password or create another admin account before using the system for real barangay records.

## Test Data For Barangay Survey

Before giving the website to barangay staff for testing, load the sample records:

```bash
npm run seed:test
```

This adds sample equipment, borrowers, transactions, return records, and staff accounts for barangay evaluation.

```text
Admin:   barangay.admin / Barangay2026!
Staff:   lending.staff / Barangay2026!
Encoder: records.encoder / Barangay2026!
```

Use these only for the testing and survey period. Do not enter real resident information during testing.

## Update The Project Later

If the project was cloned using Git, group members can get the latest changes by running:

```bash
git pull
```

Then install any new dependencies if needed:

```bash
npm install
```

## Common Problems

If `npm start` does not work, make sure Node.js is installed and run:

```bash
npm install
```

If the browser cannot open the app, make sure the server is still running and visit:

```text
http://localhost:3000
```

If port `3000` is already being used, change the `PORT` value in `.env`.
