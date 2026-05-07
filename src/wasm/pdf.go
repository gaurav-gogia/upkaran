package wasm

import (
	"bytes"
	"errors"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// InitPdfcpu disables pdfcpu's config-directory lookup so it never tries
// to read files from disk – mandatory in the browser WASM sandbox.
func InitPdfcpu() {
	api.DisableConfigDir()
}

// CompressPDF is the Go-side hook for PDF compression in WASM mode.
// This scaffold returns input as-is, but preserves the API contract and
// quality knob so a dedicated optimizer can be dropped in later.
func CompressPDF(input []byte, quality int) ([]byte, error) {
	_ = quality
	return input, nil
}

// LockPDF encrypts a PDF with an open password using AES-256.
func LockPDF(input []byte, password string) ([]byte, error) {
	if len(input) == 0 {
		return nil, errors.New("no PDF input provided")
	}

	pw := strings.TrimSpace(password)
	if pw == "" {
		return nil, errors.New("password is required")
	}

	// Belt-and-suspenders: ensure no filesystem access even if InitPdfcpu
	// was somehow not called first.
	api.DisableConfigDir()

	conf := model.NewAESConfiguration(pw, pw, 256)
	conf.Permissions = model.PermissionsAll

	var out bytes.Buffer
	if err := api.Encrypt(bytes.NewReader(input), &out, conf); err != nil {
		return nil, err
	}

	return out.Bytes(), nil
}
