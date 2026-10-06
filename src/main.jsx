import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@picocss/pico/css/pico.min.css";
import "./styles.css";
import App from "./App.jsx";
import { installCloudSync } from "./cloudSync.js";

installCloudSync();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const updatingExistingApp = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updatingExistingApp || reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch((error) => {
      console.warn("تعذر تشغيل وضع العمل دون إنترنت.", error);
    });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
