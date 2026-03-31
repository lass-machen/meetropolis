import type { ReactNode } from 'react';

interface PubStepIndicatorProps {
  steps: number;
  currentStep: number; // 1-based
  completedSteps?: number[];
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function PubStepIndicator({
  steps,
  currentStep,
  completedSteps = [],
}: PubStepIndicatorProps) {
  const items: ReactNode[] = [];

  for (let i = 1; i <= steps; i++) {
    const isCompleted = completedSteps.includes(i);
    const isActive = i === currentStep;

    let circleClass = 'pub-step__circle';
    if (isCompleted) {
      circleClass += ' pub-step__circle--completed';
    } else if (isActive) {
      circleClass += ' pub-step__circle--active';
    } else {
      circleClass += ' pub-step__circle--inactive';
    }

    items.push(
      <span key={`step-${i}`} className={circleClass}>
        {isCompleted ? <CheckIcon /> : i}
      </span>
    );

    if (i < steps) {
      const connectorCompleted = isCompleted || completedSteps.includes(i);
      items.push(
        <span
          key={`conn-${i}`}
          className={`pub-step__connector ${
            connectorCompleted
              ? 'pub-step__connector--completed'
              : 'pub-step__connector--upcoming'
          }`}
        />
      );
    }
  }

  return <div className="pub-step-indicator">{items}</div>;
}
