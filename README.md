# Paisadu Data Extractor

Paisadu Data Extractor is a professional web application that automates the extraction of key customer data (City, Phone Number, and Amount) from scanned PDF documents and images (JPG, JPEG, PNG) using OCR. It provides an interactive validation UI, records manual data corrections, and supports formatting-rich exports to Excel and executive PDF formats.

---

## 🚀 Key Features

* **High-Accuracy OCR**: Powered by `Tesseract.js` and `Sharp` for advanced image preprocessing (contrast enhancement, resizing, and noise reduction).
* **Interactive Data Table**: View, search, filter, and edit extracted records in real-time. Rows requiring verification are flagged with a **Needs Review** status.
* **Smart Local Corrections**: Track correction logs in a local JSON storage (`corrections.json`) to refine data matching over time.
* **Custom Excel Export**:
  * Freezes the header row and adds filters automatically.
  * Preserves numeric formatting (`#,##0.00`) for amounts and text formatting (`@`) for phone numbers.
  * Automatically adds exactly **3 blank rows** between records of different PDF pages.
* **Executive PDF Reports**: Generates group-by-page tables with modern, corporate-styled headers and color-coded review tags.

---

## 🛠️ Technology Stack

### Frontend
* **Core**: React 19, TypeScript
* **Styling**: TailwindCSS v4 (using Vite CSS integrations)
* **Build System**: Vite 7
* **Icons**: Lucide React

### Backend
* **Runtime**: Node.js (ES Modules)
* **Web Framework**: Express.js
* **OCR**: Tesseract.js
* **Image Processing**: Sharp & pdf2pic (PDF-to-Image converter)
* **Document Generation**: xlsx (SheetJS) & pdfkit (PDF compiler)
* **File Handling**: Multer

---

## 📂 Project Structure

```text
paisadu-data-extractor/
├── backend/                  # Node.js + Express Backend
│   ├── server.js             # Express API routes, Excel/PDF generation
│   ├── ocrService.js         # Image preprocessing, PDF conversion & OCR logic
│   ├── package.json          # Backend dependencies and scripts
│   └── corrections.json      # Saved manual user correction logs
├── src/                      # React Frontend Source
│   ├── components/           # UI components
│   │   ├── Navbar.tsx        # Styled & responsive header branding
│   │   ├── FileUploader.tsx  # Document upload dropzone
│   │   ├── DataTable.tsx     # Extracted records table with export actions
│   │   ├── EditRowModal.tsx  # Dialog for correcting values
│   │   └── ExtractionProgress.tsx # Live visual loader
│   ├── services/             # API clients
│   │   └── apiClient.ts      # Axios wrapper for endpoint coordination
│   ├── App.tsx               # Main application component
│   └── main.tsx              # React entrypoint
├── package.json              # Frontend dependencies and scripts
└── vite.config.ts            # Vite configuration
```

---

## ⚙️ Setup and Installation

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

### 1. Backend Setup
1. Open a terminal and navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   * **Development (auto-reload)**:
     ```bash
     npm run dev
     ```
   * **Production**:
     ```bash
     npm start
     ```
   * *The backend server runs on `http://localhost:5001`.*

### 2. Frontend Setup
1. Open a new terminal in the root directory:
   ```bash
   npm install
   ```
2. Start the Vite development server:
   ```bash
   npm run dev
   ```
   * *The frontend app runs on `http://localhost:5173`.*

---

## 🔌 API Reference

### `GET /api/health`
Checks backend status.
* **Response**: `{"success": true, "message": "Backend running", "port": 5001}`

### `POST /api/extract`
Uploads a document (PDF/Image) for OCR extraction.
* **Payload**: `multipart/form-data` with `file`
* **Response**: Extracted record rows, metadata, page counts, and accuracy indicators.

### `POST /api/corrections`
Submits manual correction overrides to be stored in the local `corrections.json`.
* **Body (JSON)**:
  ```json
  {
    "fieldType": "city" | "phone" | "amount",
    "oldValue": "extracted text",
    "correctedValue": "user verified text",
    "originalOcrText": "raw ocr string"
  }
  ```

### `POST /api/export/excel`
Generates a customized Excel sheet.
* **Body (JSON)**: Array of verified table rows.
* **Returns**: Excel binary stream (`.xlsx`).

### `POST /api/export/pdf`
Generates a print-ready executive PDF report.
* **Body (JSON)**: Array of verified table rows.
* **Returns**: PDF binary stream (`.pdf`).
