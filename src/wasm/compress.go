package wasm

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"path/filepath"
	"sort"
	"strings"
)

func cleanArchiveName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "file.bin"
	}
	base := filepath.ToSlash(trimmed)
	base = strings.TrimPrefix(base, "/")
	base = strings.ReplaceAll(base, "..", "_")
	if base == "" {
		return "file.bin"
	}
	return base
}

// GzipBytes compresses a single binary payload into gzip format.
func GzipBytes(input []byte) ([]byte, error) {
	var buf bytes.Buffer
	gzw := gzip.NewWriter(&buf)
	if _, err := gzw.Write(input); err != nil {
		return nil, err
	}
	if err := gzw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ZipBatch packages a file map into a ZIP archive.
func ZipBatch(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, rawName := range names {
		name := cleanArchiveName(rawName)
		w, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(files[rawName]); err != nil {
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// TarBatch packages a file map into a TAR archive.
func TarBatch(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, rawName := range names {
		name := cleanArchiveName(rawName)
		data := files[rawName]
		hdr := &tar.Header{
			Name: name,
			Mode: 0o644,
			Size: int64(len(data)),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, err
		}
		if _, err := tw.Write(data); err != nil {
			return nil, err
		}
	}

	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
