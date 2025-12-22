import { BrowserRouter, Routes, Route } from "react-router-dom";
import Balance from "./pages/Balance.jsx";
import BalanceChart from "./pages/BalanceChart.jsx";
import BudgetInput from "./pages/BudgetInput.jsx";
import FXOptions from "./pages/FXOptions.jsx";
import CashFlow from "./pages/CashFlow.jsx";
import CashFlowMonthly from "./pages/CashFlowMonthly.jsx";
import BudgetRealization from "./pages/BudgetRealization.jsx";
import TransActual from "./pages/TransActual.jsx";
import TransBudget from "./pages/TransBudget.jsx";
import Home from "./pages/Home.jsx";
import RefreshPS from "./pages/RefreshPS.jsx";
import UploadPS from "./pages/UploadPS.jsx";
import FCExpSetup from "./pages/FCExpSetup.jsx";
import FCScenarios from "./pages/FCScenarios.jsx";
import FCModuleManage from "./pages/FCModuleManage.jsx";
import FCReview from "./pages/FCReview.jsx";

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
        <Route path="/balance-chart" element={<BalanceChart />} />
        <Route path="/budget-worksheet" element={<BudgetInput />} />
        <Route path="/fx-options" element={<FXOptions />} />
        <Route path="/budget-realization" element={<BudgetRealization />} />
        <Route path="/trans-actual" element={<TransActual />} />
        <Route path="/trans-budget" element={<TransBudget />} />
        <Route path="/forecast-setup-exp" element={<FCExpSetup />} />
        <Route path="/forecast-scenarios" element={<FCScenarios />} />
        <Route path="/forecast-modules" element={<FCModuleManage />} />
        <Route path="/forecast-review" element={<FCReview />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
