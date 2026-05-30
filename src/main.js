import "./styles/material.css";
import "./styles/overhaul.css";
import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")
});

if ("serviceWorker" in navigator) {
  const isLocalDev = import.meta.env.DEV || ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  window.addEventListener("load", () => {
    if (isLocalDev) {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch((error) => {
          console.error("Service worker cleanup failed:", error);
        });
      return;
    }

    const base = import.meta.env.BASE_URL || "/";
    const swUrl = `${base.replace(/\/$/, "")}/service-worker.js`;
    navigator.serviceWorker.register(swUrl).catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}

export default app;
