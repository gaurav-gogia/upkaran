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

func wasmCompressPDF(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.Null()
	}
	quality := 75
	if len(args) > 1 {
		quality = args[1].Int()
	}
	out, err := wasm.CompressPDF(jsToBytes(args[0]), quality)
	if err != nil {
		return errorToJS(err)
	}
	return bytesToJS(out)
}

func main() {
	js.Global().Set("wasmCompressPDF", js.FuncOf(wasmCompressPDF))
	select {}
}
