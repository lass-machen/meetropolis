import React, { useId } from 'react';

interface PubInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
  hint?: string;
  error?: string;
}

export function PubInput({ label, icon, hint, error, className = '', id: externalId, ...rest }: PubInputProps) {
  const generatedId = useId();
  const inputId = externalId ?? generatedId;

  const inputClasses = ['pub-input', icon ? 'pub-input--with-icon' : '', className].filter(Boolean).join(' ');

  return (
    <div className="pub-input-group">
      {label && (
        <label htmlFor={inputId} className="pub-input-label">
          {label}
        </label>
      )}
      <div className="pub-input-wrapper">
        {icon && <span className="pub-input-icon">{icon}</span>}
        <input id={inputId} className={inputClasses} {...rest} />
      </div>
      {error && <span className="pub-input-error">{error}</span>}
      {!error && hint && <span className="pub-input-hint">{hint}</span>}
    </div>
  );
}
