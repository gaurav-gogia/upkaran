function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  return Boolean(window.navigator?.standalone);
}

export function createPwaInstallController() {
  if (typeof window === "undefined") {
    return {
      subscribe(callback) {
        callback({ canInstall: false, installed: false });
        return () => {};
      },
      promptInstall: async () => ({ outcome: "unavailable" }),
      dispose: () => {}
    };
  }

  let deferredPromptEvent = null;
  let installed = isStandaloneDisplayMode();
  const listeners = new Set();

  const emit = () => {
    const snapshot = {
      canInstall: Boolean(deferredPromptEvent) && !installed,
      installed
    };
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const onBeforeInstallPrompt = (event) => {
    event.preventDefault();
    deferredPromptEvent = event;
    emit();
  };

  const onAppInstalled = () => {
    installed = true;
    deferredPromptEvent = null;
    emit();
  };

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);

  return {
    subscribe(callback) {
      listeners.add(callback);
      callback({
        canInstall: Boolean(deferredPromptEvent) && !installed,
        installed
      });
      return () => {
        listeners.delete(callback);
      };
    },
    async promptInstall() {
      if (!deferredPromptEvent || installed) {
        return { outcome: "unavailable" };
      }

      const promptEvent = deferredPromptEvent;
      deferredPromptEvent = null;
      promptEvent.prompt();

      let choice = { outcome: "dismissed" };
      try {
        choice = await promptEvent.userChoice;
      } catch {
        choice = { outcome: "dismissed" };
      }

      if (choice?.outcome === "accepted") {
        installed = true;
      }

      emit();
      return choice;
    },
    dispose() {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      listeners.clear();
    }
  };
}
