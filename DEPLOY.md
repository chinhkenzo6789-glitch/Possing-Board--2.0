# Deploy Chuẩn Từ GitHub Repo

## Kiến trúc hiện tại

- GitHub: chứa source code
- Cloudflare Workers: host web online + xử lý API lưu `board state`
- Cloudinary: lưu ảnh online
- Board state hiện vẫn lưu qua `GET/PUT /api/board`

Project này không nên host bằng GitHub Pages vì app cần API backend cho phần board state.

## Storage đang dùng

- Ảnh: `Cloudinary`
- Board state: `Cloudflare Worker` + storage backend hiện tại

## File quan trọng

- Frontend: [index.html](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/index.html:1), [script.js](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/script.js:1), [style.css](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/style.css:1)
- Config frontend: [config.js](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/config.js:1)
- Worker: [worker/index.js](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/worker/index.js:1)
- Cloudflare config: [wrangler.jsonc](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/wrangler.jsonc:1)
- GitHub Actions deploy: [.github/workflows/deploy.yml](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/.github/workflows/deploy.yml:1)

## 1. Cấu hình Cloudinary

Mở [config.js](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/config.js:1) và điền:

```js
window.POSINGBOARD_CONFIG = {
  apiBase: "https://possingboard.chipkenzo6789.workers.dev/api",
  cloudinary: {
    cloudName: "ten-cloud-cua-anh",
    uploadPreset: "unsigned_preset_cua_anh",
    folder: "possingboard/Data",
  },
};
```

Anh cần tạo `unsigned upload preset` trong Cloudinary trước. Theo docs Cloudinary, unsigned upload từ browser cần `upload_preset`: [Upload presets](https://cloudinary.com/documentation/upload_presets), [Upload API reference](https://cloudinary.com/documentation/image_upload_api_reference).

## 2. Luồng dữ liệu

- Chọn ảnh từ máy trên web
- Frontend upload trực tiếp lên Cloudinary
- Cloudinary trả về `secure_url`
- Node lưu `src` bằng URL Cloudinary đó
- Board state vẫn lưu qua `/api/board`

## 3. Quy trình deploy từ GitHub

### Đưa source lên GitHub

```bash
git init
git add .
git commit -m "Initial posingboard web worker setup"
git branch -M main
git remote add origin <github-repo-url>
git push -u origin main
```

### Tạo Cloudflare token cho GitHub Actions

Tối thiểu:

- `Account` -> `Workers Scripts` -> `Write`
- quyền storage/backend mà worker board state đang cần

### Thêm GitHub Secrets

Trong repo GitHub:

`Settings` -> `Secrets and variables` -> `Actions`

Tạo:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Giá trị account id hiện tại:

```text
723d9ee8fb2f0fe946f51fd94e994092
```

## 4. GitHub Actions tự deploy

Workflow đã có sẵn ở:

- [.github/workflows/deploy.yml](/C:/Users/Admin/Documents/APP-Electron/POSINGBOARD/6/.github/workflows/deploy.yml:1)

Push branch `main` sẽ:

1. checkout code
2. `npm install`
3. `npm run check`
4. `wrangler deploy`

## 5. Chạy local

```bash
npm install
npm run check
npx wrangler login
npm run dev
```

## 6. Ghi chú

- Ảnh không còn upload vào R2 nữa
- Nếu `cloudName` hoặc `uploadPreset` trống, app sẽ báo lỗi cấu hình Cloudinary
- `uploadPreset` phải là loại `unsigned`
- Nếu sau này anh muốn an toàn hơn, có thể chuyển sang signed upload qua backend thay vì unsigned upload từ browser
