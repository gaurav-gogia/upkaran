//go:build js && wasm

package main

import "syscall/js"

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

func wasmConcatUint8(_ js.Value, args []js.Value) any {
	if len(args) < 2 {
		return js.Null()
	}
	a := jsToBytes(args[0])
	b := jsToBytes(args[1])
	out := make([]byte, 0, len(a)+len(b))
	out = append(out, a...)
	out = append(out, b...)
	return bytesToJS(out)
}

func main() {
	js.Global().Set("wasmConcatUint8", js.FuncOf(wasmConcatUint8))
	select {}
}
