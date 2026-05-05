//go:build js && wasm

package main

import (
	"syscall/js"
	"upkaran/wasm"
)

func jsToBytes(v js.Value) []byte {
	if v.IsNull() || v.IsUndefined() {
		return nil
	}
	out := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(out, v)
	return out
}

func bytesToJS(data []byte) js.Value {
	arr := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(arr, data)
	return arr
}

func errorToJS(err error) js.Value {
	return js.Global().Get("Error").New(err.Error())
}

func jsObjectToFileMap(v js.Value) map[string][]byte {
	result := map[string][]byte{}
	if v.IsNull() || v.IsUndefined() {
		return result
	}
	keys := js.Global().Get("Object").Call("keys", v)
	for i := 0; i < keys.Length(); i += 1 {
		key := keys.Index(i).String()
		result[key] = jsToBytes(v.Get(key))
	}
	return result
}

func wasmGzipBytes(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.Null()
	}
	out, err := wasm.GzipBytes(jsToBytes(args[0]))
	if err != nil {
		return errorToJS(err)
	}
	return bytesToJS(out)
}

func wasmZipBatch(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.Null()
	}
	out, err := wasm.ZipBatch(jsObjectToFileMap(args[0]))
	if err != nil {
		return errorToJS(err)
	}
	return bytesToJS(out)
}

func wasmTarBatch(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.Null()
	}
	out, err := wasm.TarBatch(jsObjectToFileMap(args[0]))
	if err != nil {
		return errorToJS(err)
	}
	return bytesToJS(out)
}

func main() {
	js.Global().Set("wasmGzipBytes", js.FuncOf(wasmGzipBytes))
	js.Global().Set("wasmZipBatch", js.FuncOf(wasmZipBatch))
	js.Global().Set("wasmTarBatch", js.FuncOf(wasmTarBatch))
	select {}
}
