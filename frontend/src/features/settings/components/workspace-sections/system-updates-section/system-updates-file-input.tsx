import type { RefObject } from 'react';

export interface SystemUpdatesFileInputProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
export function SystemUpdatesFileInput({ fileInputRef, handleFileChange }: SystemUpdatesFileInputProps) {
  return (
    <input type="file" accept=".zip" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
  );
}
