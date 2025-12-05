import { BrowserRouter, Routes, Route } from "react-router-dom";
import Balance from "./pages/Balance.jsx";
import BalanceChart from "./pages/BalanceChart.jsx";
import BudgetInput from "./pages/BudgetInput.jsx";
import BudgetOptions from "./pages/BudgetOptions.jsx";
import CashFlow from "./pages/CashFlow.jsx";
import CashFlowMonthly from "./pages/CashFlowMonthly.jsx";
import BudgetRealization from "./pages/BudgetRealization.jsx";
import TransBudget from "./pages/TransBudget.jsx";
import Home from "./pages/Home.jsx";
import History from "./pages/History.jsx";
import RefreshPS from "./pages/RefreshPS.jsx";
import UploadPS from "./pages/UploadPS.jsx";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/balance" element={<Balance />} />
        <Route path="/cash-flow" element={<CashFlow />} />
        <Route path="/cash-flow-monthly" element={<CashFlowMonthly />} />
        <Route path="/upload-ps" element={<UploadPS />} />
        <Route path="/refresh-ps" element={<RefreshPS />} />
        <Route path="/history" element={<History />} />
        <Route path="/balance-chart" element={<BalanceChart />} />
        <Route path="/budget-worksheet" element={<BudgetInput />} />
        <Route path="/budget-options" element={<BudgetOptions />} />
        <Route path="/budget-realization" element={<BudgetRealization />} />
        <Route path="/trans-budget" element={<TransBudget />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
