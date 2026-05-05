package wasm

import "sort"

// ConcatBytes joins two byte slices and returns a new combined slice.
func ConcatBytes(a []byte, b []byte) []byte {
	out := make([]byte, 0, len(a)+len(b))
	out = append(out, a...)
	out = append(out, b...)
	return out
}

// SortedKeys returns stable key ordering for deterministic archive creation.
func SortedKeys(data map[string][]byte) []string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
