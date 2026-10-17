const $ = (id) => document.getElementById(id);
let accounts = [];
let transactions = [];
let currentOperation = "create";

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function notify(message, type = "success") {
  const el = $("notice");
  el.textContent = message;
  el.className = `notice ${type}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.add("hidden"), 5000);
}

function emptyRow(columns, message = "No records to display yet.") {
  return `<tr><td colspan="${columns}" class="empty">${escapeHtml(message)}</td></tr>`;
}

function accountRow(account, action = false) {
  return `<tr>
    <td><div class="holder"><div class="holder-avatar">${escapeHtml(initials(account.name))}</div><div><strong>${escapeHtml(account.name)}</strong><small>Individual account</small></div></div></td>
    <td class="account-num">#${account.accountNumber}</td>
    <td class="money">${money(account.balance)}</td>
    <td><span class="badge">Active</span></td>
    ${action ? `<td><div class="row-actions"><button class="small-action" data-account-op="deposit" data-number="${account.accountNumber}">Deposit</button><button class="small-action" data-account-op="withdraw" data-number="${account.accountNumber}">Withdraw</button></div></td>` : ""}
  </tr>`;
}

function transactionRow(tx) {
  const type = String(tx.type || "");
  const isWithdrawal = type.toLowerCase() === "withdrawal";
  const isOpen = type.toLowerCase().includes("opened");
  const amountClass = isWithdrawal ? "amount-negative" : "amount-positive";
  const prefix = isWithdrawal ? "−" : "+";
  return `<tr>
    <td><span class="type ${isWithdrawal ? "withdraw" : isOpen ? "open" : "deposit"}">${escapeHtml(type)}</span></td>
    <td class="account-num">#${tx.accountNumber}</td>
    <td>${escapeHtml(tx.timestamp || "—")}</td>
    <td class="${amountClass}">${prefix}${money(tx.amount)}</td>
    <td class="money">${money(tx.balanceAfter)}</td>
  </tr>`;
}

async function refreshData() {
  [accounts, transactions] = await Promise.all([
    api("/api/accounts"),
    api("/api/transactions")
  ]);
  renderDashboard();
  renderAccounts();
  renderTransactions();
}

function renderDashboard() {
  const total = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  $("total-balance").textContent = money(total);
  $("total-accounts").textContent = accounts.length;
  $("total-transactions").textContent = transactions.length;
  $("average-balance").textContent = money(accounts.length ? total / accounts.length : 0);
  $("recent-accounts").innerHTML = accounts.length
    ? [...accounts].slice(-5).reverse().map(a => accountRow(a)).join("")
    : emptyRow(4, "No accounts yet. Create your first customer account.");
  $("recent-transactions").innerHTML = transactions.length
    ? [...transactions].reverse().slice(0, 5).map(transactionRow).join("")
    : emptyRow(5, "No transactions recorded yet.");
}

function renderAccounts() {
  const term = $("account-search").value.trim().toLowerCase();
  const filtered = accounts.filter(a => String(a.name).toLowerCase().includes(term) || String(a.accountNumber).includes(term));
  $("all-accounts").innerHTML = filtered.length ? [...filtered].reverse().map(a => accountRow(a, true)).join("") : emptyRow(5, "No matching accounts found.");
  $("account-count").textContent = `${filtered.length} account${filtered.length === 1 ? "" : "s"}`;
}

function renderTransactions() {
  const term = $("transaction-search").value.trim();
  const filtered = transactions.filter(tx => !term || String(tx.accountNumber).includes(term));
  $("all-transactions").innerHTML = filtered.length ? [...filtered].reverse().map(transactionRow).join("") : emptyRow(5, "No matching transactions found.");
  $("transaction-count").textContent = `${filtered.length} record${filtered.length === 1 ? "" : "s"}`;
}

function setView(view) {
  ["dashboard", "accounts", "transactions"].forEach(name => $(`${name}-view`).classList.toggle("hidden", name !== view));
  document.querySelectorAll("[data-view]").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  const labels = { dashboard: "Overview", accounts: "Accounts", transactions: "Transactions" };
  $("crumb").textContent = labels[view];
  $("page-title").textContent = view === "dashboard" ? "Good day, Administrator" : labels[view];
}

function openModal(operation, accountNumber = "") {
  currentOperation = operation;
  const settings = {
    create: { title: "Create account", description: "Add a new customer to your banking workspace.", name: true, account: false, amount: "Opening balance", help: "Enter 0 or a positive opening balance.", submit: "Create account", min: "0" },
    deposit: { title: "Make a deposit", description: "Add funds to an existing customer account.", name: false, account: true, amount: "Deposit amount", help: "Amount must be greater than zero.", submit: "Confirm deposit", min: "0.01" },
    withdraw: { title: "Withdraw funds", description: "Withdraw funds from an existing customer account.", name: false, account: true, amount: "Withdrawal amount", help: "Withdrawals cannot exceed the available balance.", submit: "Confirm withdrawal", min: "0.01" }
  }[operation];
  $("modal-title").textContent = settings.title;
  $("modal-description").textContent = settings.description;
  $("name-field").classList.toggle("hidden", !settings.name);
  $("account-field").classList.toggle("hidden", !settings.account);
  $("amount-label").textContent = settings.amount;
  $("amount-help").textContent = settings.help;
  $("submit-operation").textContent = settings.submit;
  $("amount").min = settings.min;
  $("customer-name").value = "";
  $("account-number").value = accountNumber || "";
  $("amount").value = "";
  $("modal-backdrop").classList.remove("hidden");
  setTimeout(() => (settings.name ? $("customer-name") : settings.account ? $("account-number") : $("amount")).focus(), 50);
}

function closeModal() {
  $("modal-backdrop").classList.add("hidden");
}

async function submitOperation(event) {
  event.preventDefault();
  const amount = Number($("amount").value);
  try {
    if (currentOperation === "create") {
      const name = $("customer-name").value.trim();
      if (!name) throw new Error("Enter the account holder's name.");
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid opening balance.");
      const account = await api("/api/accounts", { method: "POST", body: JSON.stringify({ name, openingBalance: amount }) });
      closeModal();
      await refreshData();
      notify(`Account #${account.accountNumber} created successfully.`);
    } else {
      const accountNumber = Number($("account-number").value);
      if (!Number.isInteger(accountNumber) || accountNumber <= 0) throw new Error("Enter a valid account number.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
      const endpoint = currentOperation === "deposit" ? "/api/deposit" : "/api/withdraw";
      const result = await api(endpoint, { method: "POST", body: JSON.stringify({ accountNumber, amount }) });
      closeModal();
      await refreshData();
      notify(`${result.message} New balance: ${money(result.balance)}.`);
    }
  } catch (error) {
    notify(error.message, "error");
  }
}

document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
document.querySelectorAll("[data-modal]").forEach(btn => btn.addEventListener("click", () => openModal(btn.dataset.modal)));
$("new-account-top").addEventListener("click", () => openModal("create"));
$("close-modal").addEventListener("click", closeModal);
$("cancel-modal").addEventListener("click", closeModal);
$("modal-backdrop").addEventListener("click", event => { if (event.target === $("modal-backdrop")) closeModal(); });
$("operation-form").addEventListener("submit", submitOperation);
$("account-search").addEventListener("input", renderAccounts);
$("transaction-search").addEventListener("input", renderTransactions);
$("refresh-transactions").addEventListener("click", async () => {
  try { await refreshData(); notify("Transaction history refreshed."); }
  catch (error) { notify(error.message, "error"); }
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-account-op]");
  if (button) openModal(button.dataset.accountOp, button.dataset.number);
});
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });

$("today").textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date());
refreshData().catch(error => notify(`Could not connect to the C++ backend. Start banking_server and reload. Details: ${error.message}`, "error"));
