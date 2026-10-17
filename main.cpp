#include <httplib.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>

using json = nlohmann::json;
using namespace std;

const string ACCOUNTS_FILE = "accounts.json";
const string TRANSACTIONS_FILE = "transactions.json";
mutex dataMutex;

json readJsonFile(const string& path, const json& fallback) {
    ifstream file(path);
    if (!file.is_open()) return fallback;
    try {
        json data;
        file >> data;
        return data;
    } catch (...) {
        return fallback;
    }
}

bool writeJsonFile(const string& path, const json& data) {
    ofstream file(path);
    if (!file.is_open()) return false;
    file << setw(2) << data << '\n';
    return file.good();
}

json accounts() {
    return readJsonFile(ACCOUNTS_FILE, json::array());
}

json transactions() {
    return readJsonFile(TRANSACTIONS_FILE, json::array());
}

int nextAccountNumber(const json& list) {
    // Generate a unique five-digit account number in the range 10000-99999.
    // Start at 10000 and find the first unused number, including when older
    // records have four-digit account numbers from a previous version.
    for (int candidate = 10000; candidate <= 99999; ++candidate) {
        if (find_if(list.begin(), list.end(), [candidate](const json& account) {
                return account.value("accountNumber", -1) == candidate;
            }) == list.end()) {
            return candidate;
        }
    }
    return -1; // All five-digit account numbers are in use.
}

int findAccountIndex(const json& list, int number) {
    for (size_t i = 0; i < list.size(); ++i) {
        if (list[i].value("accountNumber", -1) == number) return static_cast<int>(i);
    }
    return -1;
}

void addTransaction(json& list, int number, const string& type, double amount, double balance) {
    auto now = chrono::system_clock::now();
    time_t timeNow = chrono::system_clock::to_time_t(now);
    tm localTime{};
#ifdef _WIN32
    localtime_s(&localTime, &timeNow);
#else
    localtime_r(&timeNow, &localTime);
#endif
    ostringstream timestamp;
    timestamp << put_time(&localTime, "%Y-%m-%d %H:%M:%S");

    list.push_back({
        {"id", list.size() + 1},
        {"accountNumber", number},
        {"type", type},
        {"amount", round(amount * 100.0) / 100.0},
        {"balanceAfter", round(balance * 100.0) / 100.0},
        {"timestamp", timestamp.str()}
    });
}

void sendError(httplib::Response& res, int status, const string& message) {
    res.status = status;
    res.set_content(json{{"error", message}}.dump(), "application/json");
}

int main() {
    // Ensure data files exist.
    if (!ifstream(ACCOUNTS_FILE).good()) writeJsonFile(ACCOUNTS_FILE, json::array());
    if (!ifstream(TRANSACTIONS_FILE).good()) writeJsonFile(TRANSACTIONS_FILE, json::array());

    httplib::Server server;

    server.Get("/api/accounts", [](const httplib::Request&, httplib::Response& res) {
        lock_guard<mutex> lock(dataMutex);
        res.set_content(accounts().dump(), "application/json");
    });

    server.Post("/api/accounts", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) { sendError(res, 400, "Request body must be valid JSON."); return; }

        string name = body.value("name", "");
        if (name.empty() || name.size() > 80) {
            sendError(res, 400, "Enter an account holder name (maximum 80 characters)."); return;
        }
        if (!body.contains("openingBalance") || !body["openingBalance"].is_number()) {
            sendError(res, 400, "Enter a valid opening balance."); return;
        }
        double opening = body["openingBalance"].get<double>();
        if (!isfinite(opening) || opening < 0 || opening > 1000000000.0) {
            sendError(res, 400, "Opening balance must be between 0 and 1,000,000,000."); return;
        }

        lock_guard<mutex> lock(dataMutex);
        json list = accounts();
        int number = nextAccountNumber(list);
        if (number < 0) {
            sendError(res, 503, "No five-digit account numbers are available."); return;
        }
        json account = {
            {"accountNumber", number},
            {"name", name},
            {"balance", round(opening * 100.0) / 100.0}
        };
        list.push_back(account);
        json tx = transactions();
        addTransaction(tx, number, "Account opened", opening, opening);

        if (!writeJsonFile(ACCOUNTS_FILE, list) || !writeJsonFile(TRANSACTIONS_FILE, tx)) {
            sendError(res, 500, "Could not save account data."); return;
        }
        res.status = 201;
        res.set_content(account.dump(), "application/json");
    });

    auto transactionHandler = [](const httplib::Request& req, httplib::Response& res, bool isDeposit) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) { sendError(res, 400, "Request body must be valid JSON."); return; }

        if (!body.contains("accountNumber") || !body["accountNumber"].is_number_integer() ||
            !body.contains("amount") || !body["amount"].is_number()) {
            sendError(res, 400, "Enter a valid account number and amount."); return;
        }

        int number = body["accountNumber"].get<int>();
        double amount = body["amount"].get<double>();
        if (!isfinite(amount) || amount <= 0 || amount > 1000000000.0) {
            sendError(res, 400, "Amount must be greater than zero and no more than 1,000,000,000."); return;
        }
        amount = round(amount * 100.0) / 100.0;

        lock_guard<mutex> lock(dataMutex);
        json list = accounts();
        int index = findAccountIndex(list, number);
        if (index < 0) { sendError(res, 404, "Account not found."); return; }

        double balance = list[index]["balance"].get<double>();
        if (!isDeposit && amount > balance) {
            sendError(res, 400, "Insufficient funds. The withdrawal was not processed."); return;
        }

        balance = isDeposit ? balance + amount : balance - amount;
        balance = round(balance * 100.0) / 100.0;
        list[index]["balance"] = balance;

        json tx = transactions();
        addTransaction(tx, number, isDeposit ? "Deposit" : "Withdrawal", amount, balance);

        if (!writeJsonFile(ACCOUNTS_FILE, list) || !writeJsonFile(TRANSACTIONS_FILE, tx)) {
            sendError(res, 500, "Could not save transaction."); return;
        }

        res.set_content(json{
            {"accountNumber", number},
            {"amount", amount},
            {"balance", balance},
            {"message", isDeposit ? "Deposit completed successfully." : "Withdrawal completed successfully."}
        }.dump(), "application/json");
    };

    server.Post("/api/deposit", [transactionHandler](const httplib::Request& req, httplib::Response& res) {
        transactionHandler(req, res, true);
    });
    server.Post("/api/withdraw", [transactionHandler](const httplib::Request& req, httplib::Response& res) {
        transactionHandler(req, res, false);
    });

    server.Get("/api/transactions", [](const httplib::Request& req, httplib::Response& res) {
        int number = 0;
        if (req.has_param("accountNumber")) {
            try { number = stoi(req.get_param_value("accountNumber")); }
            catch (...) { sendError(res, 400, "Invalid account number."); return; }
        }
        lock_guard<mutex> lock(dataMutex);
        json all = transactions();
        json result = json::array();
        for (const auto& tx : all) {
            if (number == 0 || tx.value("accountNumber", -1) == number) result.push_back(tx);
        }
        res.set_content(result.dump(), "application/json");
    });

    server.set_mount_point("/", "./public");
    cout << "Banking Management System is running.\n";
    int port = 8080;
    if (const char* envPort = getenv("PORT")) {
        try { port = stoi(envPort); }
        catch (...) { cerr << "Invalid PORT environment variable.\n"; return 1; }
    }
    cout << "Banking Management System listening on port " << port << ".\n";

    if (!server.listen("0.0.0.0", port)) {
        cerr << "Could not start server on port " << port << ".\n";
        return 1;
    }
    return 0;
}
