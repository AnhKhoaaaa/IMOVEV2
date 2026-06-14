# IMOVEV2 LaTeX Report

## File đơn được khuyến nghị

Theo yêu cầu hiện tại, file cần chạy là:

```powershell
xelatex IMOVEV2_Report.tex
xelatex IMOVEV2_Report.tex
```

`IMOVEV2_Report.tex` là file độc lập, đã chứa toàn bộ nội dung, cấu hình và sơ đồ TikZ. Các vị trí chưa có dữ liệu được ghi trực tiếp là `Điền vào đây`, `Dán hình ảnh vào đây` hoặc `Dán link video YouTube vào đây`.

## Build

```powershell
cd report
latexmk -xelatex main.tex
```

Nếu bibliography chưa được chạy tự động:

```powershell
biber main
latexmk -xelatex main.tex
```

## Kiểm tra dữ liệu còn thiếu

```powershell
Get-Content TODO_REQUIRED.md
```

Bản PDF hiện compile được với placeholder hiển thị rõ. Trước khi nộp, phải thay toàn bộ placeholder trong `config/metadata.tex` và các chapter, rồi xóa `TODO_REQUIRED.md`.

Kiểm tra author metadata và trạng thái phát hành:

```powershell
.\check-report.ps1
```

## Lưu ý

- Engine bắt buộc: XeLaTeX.
- Font mặc định: TeX Gyre Termes/Heros/Cursor.
- Sơ đồ kỹ thuật được vẽ trực tiếp bằng TikZ.
- Không commit API key, token hoặc file `.env`.
