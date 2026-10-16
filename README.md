# Banking Management System

A learning/demo banking application with a C++ HTTP backend and browser-based interface.

## Run locally

Requires CMake, a C++17 compiler, Git, and internet access on the first build (CMake downloads cpp-httplib and nlohmann/json).

```bash
cmake -S . -B build
cmake --build build
./build/banking_server
```

Open http://localhost:8080. The app uses `PORT` if set; otherwise it defaults to port 8080.

## Deploy to Render

1. Upload the contents of this project folder to a GitHub repository.
2. In Render, create **New → Web Service** and connect the repository.
3. Choose **Docker** as the runtime. Keep the Dockerfile path as `./Dockerfile`.
4. Create the service. The app listens on `0.0.0.0` and uses Render's `PORT` environment variable.

## Important storage limitation

Accounts and transactions are stored in `accounts.json` and `transactions.json` in the app's working directory. On hosting platforms, local filesystem data may not survive redeploys/restarts unless you configure persistent storage. For reliable long-term data, use a managed database. This is an educational demo, not a real banking system; it does not provide production-grade authentication, authorization, encryption, audit controls, or financial safeguards.
