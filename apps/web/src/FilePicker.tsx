import { useId, useState } from "react";

interface Props {
  readonly title: string;
  readonly hint: string;
  readonly accept: string;
  readonly files: readonly File[];
  readonly disabled: boolean;
  readonly multiple?: boolean;
  readonly onChange: (files: File[]) => void;
}

export function FilePicker({ title, hint, accept, files, disabled, multiple = false, onChange }: Props) {
  const inputId = useId();
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    if (list === null) return;
    const picked = [...list];
    onChange(multiple ? picked : picked.slice(0, 1));
  };

  return (
    <div
      className={`picker${over ? " over" : ""}${files.length > 0 ? " filled" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) take(event.dataTransfer.files);
      }}
    >
      <h2>{title}</h2>
      <p className="hint">{hint}</p>

      {files.length > 0 ? (
        <ul className="files">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              <span className="name">{file.name}</span>
              <span className="size">{formatSize(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">ลากไฟล์มาวาง หรือเลือกไฟล์</p>
      )}

      <div className="actions">
        <label className="button" htmlFor={inputId}>
          เลือกไฟล์
        </label>
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(event) => take(event.target.files)}
        />
        {files.length > 0 && (
          <button type="button" className="link" disabled={disabled} onClick={() => onChange([])}>
            ล้าง
          </button>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
