import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { AuthProvider } from "./auth/AuthContext";
import { ChannelIdentityProvider } from "./channels/ChannelIdentityContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider><ChannelIdentityProvider><App /></ChannelIdentityProvider></AuthProvider>
  </StrictMode>,
);
