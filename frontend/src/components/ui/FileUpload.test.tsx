import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FileUpload } from './FileUpload';

function makeFile(name: string, type: string, size?: number): File {
  const file = new File(['content'], name, { type });
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

describe('FileUpload', () => {
  let uploadFn: ReturnType<typeof vi.fn<(file: File) => Promise<unknown>>>;
  let onUpload: ReturnType<typeof vi.fn<(attachment: unknown) => void>>;

  beforeEach(() => {
    uploadFn = vi.fn().mockResolvedValue({ url: 'https://example.com/file.pdf' });
    onUpload = vi.fn();
  });

  it('renders the drop zone with expected text', () => {
    render(<FileUpload uploadFn={uploadFn} onUpload={onUpload} />);

    expect(screen.getByText('Drop a file here')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /drop files here or click to upload/i }),
    ).toBeInTheDocument();
  });

  it('rejects oversized files and shows error without calling uploadFn', async () => {
    render(<FileUpload uploadFn={uploadFn} onUpload={onUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeFile('big.pdf', 'application/pdf', 26 * 1024 * 1024);

    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument();
    });

    expect(uploadFn).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('rejects disallowed file types and shows error without calling uploadFn', async () => {
    render(<FileUpload uploadFn={uploadFn} onUpload={onUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const exeFile = makeFile('malware.exe', 'application/x-msdownload');

    fireEvent.change(input, { target: { files: [exeFile] } });

    await waitFor(() => {
      expect(screen.getByText(/file type not allowed/i)).toBeInTheDocument();
    });

    expect(uploadFn).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('calls uploadFn and onUpload for a valid file', async () => {
    const result = { url: 'https://example.com/doc.pdf' };
    uploadFn.mockResolvedValue(result);

    render(<FileUpload uploadFn={uploadFn} onUpload={onUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = makeFile('document.pdf', 'application/pdf');

    fireEvent.change(input, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(uploadFn).toHaveBeenCalledWith(validFile);
      expect(onUpload).toHaveBeenCalledWith(result);
    });

    expect(screen.queryByText(/file too large/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/file type not allowed/i)).not.toBeInTheDocument();
  });

  it('shows upload error when uploadFn rejects', async () => {
    uploadFn.mockRejectedValue(new Error('Server error'));

    render(<FileUpload uploadFn={uploadFn} onUpload={onUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = makeFile('document.pdf', 'application/pdf');

    fireEvent.change(input, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });

    expect(onUpload).not.toHaveBeenCalled();
  });

  it('dismisses the error when the X button is clicked', async () => {
    render(<FileUpload uploadFn={uploadFn} onUpload={onUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeFile('big.pdf', 'application/pdf', 26 * 1024 * 1024);

    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument();
    });

    const dismissButton = screen.getByTitle('Dismiss error');
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText(/file too large/i)).not.toBeInTheDocument();
    });
  });
});
