import { Box, ChevronRight, X } from "lucide-react";

interface ModelPickerDialogProps {
  files: File[];
  onSelect: (file: File) => void;
  onClose: () => void;
}

export function ModelPickerDialog({ files, onSelect, onClose }: ModelPickerDialogProps) {
  if (files.length === 0) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="model-picker" role="dialog" aria-modal="true" aria-labelledby="model-picker-title">
        <header><div><span>FOLDER SCAN</span><h2 id="model-picker-title">选择要载入的 PMX</h2></div><button onClick={onClose} aria-label="关闭" title="关闭"><X size={20} /></button></header>
        <p>这个文件夹包含多个模型。贴图仍会从同一文件夹内解析。</p>
        <div className="model-options">
          {files.map((file) => (
            <button key={file.webkitRelativePath || file.name} onClick={() => onSelect(file)}>
              <span className="file-icon"><Box size={20} /></span>
              <span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
