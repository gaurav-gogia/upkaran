import { writable } from "svelte/store";

export const OPERATION_STATUS = {
  IDLE: "idle",
  QUEUED: "queued",
  RUNNING: "running",
  SUCCESS: "success",
  PARTIAL: "partial",
  FAILED: "failed"
};

const initialState = {
  id: 0,
  route: "empty",
  status: OPERATION_STATUS.IDLE,
  progress: 0,
  fileCount: 0,
  outputCount: 0,
  error: "",
  startedAt: null,
  endedAt: null
};

export const activeOperation = writable({ ...initialState });

let opSeq = 0;

export function beginOperation(meta = {}) {
  const startedAt = Date.now();
  const id = ++opSeq;
  activeOperation.set({
    id,
    route: meta.route || "empty",
    status: OPERATION_STATUS.QUEUED,
    progress: 0,
    fileCount: Number(meta.fileCount) || 0,
    outputCount: 0,
    error: "",
    startedAt,
    endedAt: null
  });

  // Move to running state on next microtask to preserve lifecycle ordering.
  queueMicrotask(() => {
    activeOperation.update((state) => {
      if (state.id !== id) return state;
      return { ...state, status: OPERATION_STATUS.RUNNING };
    });
  });
}

export function updateOperationProgress(progress) {
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  activeOperation.update((state) => {
    if (state.status === OPERATION_STATUS.IDLE) return state;
    return {
      ...state,
      progress: value,
      status: state.status === OPERATION_STATUS.QUEUED ? OPERATION_STATUS.RUNNING : state.status
    };
  });
}

export function completeOperation(meta = {}) {
  activeOperation.update((state) => {
    if (state.status === OPERATION_STATUS.IDLE) return state;
    return {
      ...state,
      status: meta.status || OPERATION_STATUS.SUCCESS,
      progress: 100,
      outputCount: Number(meta.outputCount) || 0,
      endedAt: Date.now(),
      error: ""
    };
  });
}

export function failOperation(error = "Operation failed") {
  activeOperation.update((state) => {
    if (state.status === OPERATION_STATUS.IDLE) return state;
    return {
      ...state,
      status: OPERATION_STATUS.FAILED,
      endedAt: Date.now(),
      error: `${error || "Operation failed"}`
    };
  });
}

export function resetOperation() {
  activeOperation.set({ ...initialState });
}
