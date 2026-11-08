// Standalone entry point. The Muse SDK's shared `spaceQueryClient` is gone:
// this app owns its own TanStack Query client. The stylesheet is compiled
// separately by the Tailwind CLI (see client/build.mjs) and linked from
// index.html, so there is no CSS import here.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const queryClient = new QueryClient();

const rootEl = document.querySelector<HTMLElement>("[data-app-root]");
if (!rootEl) {
  throw new Error("missing app root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
