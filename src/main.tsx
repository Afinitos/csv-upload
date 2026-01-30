import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

const queryClient = new QueryClient();

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
