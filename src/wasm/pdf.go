package wasm

// CompressPDF is the Go-side hook for PDF compression in WASM mode.
// This scaffold returns input as-is, but preserves the API contract and
// quality knob so a dedicated optimizer can be dropped in later.
func CompressPDF(input []byte, quality int) ([]byte, error) {
	_ = quality
	return input, nil
}
