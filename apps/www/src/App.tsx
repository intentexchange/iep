import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./layout/Shell.js";
import { HomePage } from "./pages/Home.js";
import { ProtocolPage } from "./pages/Protocol.js";

export const App = () => {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="protocol" element={<ProtocolPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
};
