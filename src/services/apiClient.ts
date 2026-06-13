import axios from 'axios';
import { saveAs } from 'file-saver';
import { ApiExtractResponse, ExtractedRow } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
console.log("API_BASE_URL:", API_BASE_URL);

export class ExpressApiClient {
  private baseUrl: string = API_BASE_URL;

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/health`, { timeout: 4000 });
      return res.status === 200 && res.data.success === true;
    } catch (error) {
      console.error("Health check error:", error);
      return false;
    }
  }

  public async extractFile(file: File): Promise<ApiExtractResponse> {
    const formData = new FormData();
    formData.append('file', file);

    console.log("Calling extract API:", API_BASE_URL + "/api/extract");

    try {
      const res = await axios.post<ApiExtractResponse>(`${API_BASE_URL}/api/extract`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000 // 10 minutes timeout for complex image preprocessing and OCR
      });
      return res.data;
    } catch (error: any) {
      console.error("Extraction error code:", error.code);
      console.error("Extraction error response:", error.response?.data);
      console.error("Extraction error message:", error.message);

      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout') || error.code === 'ERR_CANCELED') {
        throw new Error('Extraction is taking longer than expected. Please wait or try again with a clearer file.');
      } else if (error.response) {
        throw new Error(error.response.data?.message || 'Error parsing document on backend server.');
      } else if (error.request) {
        throw new Error('Backend server is not running. Please start backend on port 5001 and try again.');
      } else {
        throw new Error('Error triggering extraction request.');
      }
    }
  }

  public async exportExcel(rows: ExtractedRow[], includeOcrText: boolean = true): Promise<void> {
    const res = await axios.post(
      `${API_BASE_URL}/api/export/excel`,
      { rows, includeOcrText },
      { responseType: 'blob' }
    );

    const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, 'Extracted_Data.xlsx');
  }

  public async exportPdf(rows: ExtractedRow[], title: string = 'Paisadu Data Extractor Executive Report', includeOcrText: boolean = true): Promise<void> {
    const res = await axios.post(
      `${API_BASE_URL}/api/export/pdf`,
      { rows, title, includeOcrText },
      { responseType: 'blob' }
    );

    const blob = new Blob([res.data], { type: 'application/pdf' });
    saveAs(blob, 'Extracted_Data_Report.pdf');
  }

  public async saveCorrection(correction: {
    fieldType: string;
    oldValue: string;
    correctedValue: string;
    originalOcrText: string;
  }): Promise<void> {
    try {
      await axios.post(`${API_BASE_URL}/api/corrections`, correction);
    } catch (error) {
      console.error("Failed to save correction to backend:", error);
    }
  }
}

export const expressApiClient = new ExpressApiClient();