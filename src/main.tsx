import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { AuthProvider } from "./auth/AuthContext";
import { ChannelIdentityProvider } from "./channels/ChannelIdentityContext";
import { I18nProvider } from "./i18n/I18nContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider><I18nProvider><ChannelIdentityProvider><App /></ChannelIdentityProvider></I18nProvider></AuthProvider>
  </StrictMode>,
);
