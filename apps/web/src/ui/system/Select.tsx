import * as React from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { Icon } from '../Icon';

export type SelectOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

export function Select({ options, value, onChange, placeholder, disabled, style, className }: SelectProps) {
  const rootProps: RadixSelect.SelectProps = { value, onValueChange: onChange };
  if (disabled) rootProps.disabled = true;

  return (
    <RadixSelect.Root {...rootProps}>
      <RadixSelect.Trigger className={`sys-select__trigger${className ? ` ${className}` : ''}`} style={style}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="sys-select__chevron">
          <ChevronIcon />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content className="sys-select__content" position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="sys-select__viewport">
            {options.map((opt) => {
              const itemProps: RadixSelect.SelectItemProps = {
                value: opt.value,
                className: 'sys-select__item',
              };
              if (opt.disabled) itemProps.disabled = true;
              return (
                <RadixSelect.Item key={opt.value} {...itemProps}>
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="sys-select__check">
                    <Icon name="check" size={12} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              );
            })}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
