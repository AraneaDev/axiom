interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Centered placeholder for zero-data states.
 * Displays an icon, title, optional description, and an optional action button.
 * @param props - EmptyState configuration.
 * @param props.icon - Optional Lucide icon node displayed above the title.
 * @param props.title - Primary message (e.g. "No issues yet").
 * @param props.description - Optional secondary text with additional context.
 * @param props.action - Optional action element, typically a Button to create the first item.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 text-text-tertiary [&>svg]:h-12 [&>svg]:w-12">{icon}</div>}
      <h3 className="text-lg font-medium text-text">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-text-secondary max-w-sm text-center">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
