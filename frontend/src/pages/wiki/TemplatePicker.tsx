import {
  BookTemplate,
  ClipboardList,
  FilePlus,
  FileText,
  RotateCcw,
  Scale,
  ScrollText,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';

import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

const BLUEPRINT_ICONS: Record<string, typeof FileText> = {
  'Meeting Notes': ClipboardList,
  Retrospective: RotateCcw,
  'Decision Record': Scale,
  'Product Requirements': ScrollText,
  Runbook: Wrench,
};

interface Template {
  id: string;
  name: string;
  description?: string | null;
  body: string;
  isBuiltIn?: boolean;
}

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (template: { name: string; body: string }) => void;
  onBlank: () => void;
}

/**
 *
 * @param root0
 * @param root0.templates
 * @param root0.onSelect
 * @param root0.onBlank
 */
export function TemplatePicker({ templates, onSelect, onBlank }: TemplatePickerProps) {
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);

  const builtIn = templates.filter((t) => t.isBuiltIn);
  const custom = templates.filter((t) => !t.isBuiltIn);
  const hoveredTpl = templates.find((t) => t.id === hoveredTemplate);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BookTemplate className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text">Choose a template</span>
      </div>
      <div className="flex gap-4">
        <div className="flex-1 space-y-4">
          {/* Blank page option */}
          <Button
            variant="outline"
            size="lg"
            className="w-full bg-surface justify-start gap-3 px-4 py-3 text-left rounded-lg hover:border-primary/50 hover:bg-surface-hover"
            onClick={onBlank}
            onMouseEnter={() => setHoveredTemplate(null)}
          >
            <FilePlus className="h-5 w-5 text-text-secondary shrink-0" />
            <div>
              <div className="font-medium text-text">Blank page</div>
              <div className="text-xs text-text-tertiary">Start from scratch</div>
            </div>
          </Button>

          {/* Built-in templates */}
          {builtIn.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">
                Built-in
              </div>
              <div className="grid grid-cols-2 gap-2">
                {builtIn.map((tpl) => {
                  const Icon = BLUEPRINT_ICONS[tpl.name] ?? FileText;
                  return (
                    <Button
                      key={tpl.id}
                      variant="outline"
                      size="lg"
                      className={cn(
                        'bg-surface justify-start gap-3 rounded-lg px-4 py-3 text-left hover:border-primary/50 hover:bg-surface-hover',
                        hoveredTemplate === tpl.id && 'border-primary/50 bg-surface-hover',
                      )}
                      onClick={() => onSelect(tpl)}
                      onMouseEnter={() => setHoveredTemplate(tpl.id)}
                      onMouseLeave={() => setHoveredTemplate(null)}
                    >
                      <Icon className="h-5 w-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-text truncate">{tpl.name}</div>
                        {tpl.description && (
                          <div className="text-xs text-text-tertiary truncate">
                            {tpl.description}
                          </div>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom templates */}
          {custom.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">
                Custom
              </div>
              <div className="grid grid-cols-2 gap-2">
                {custom.map((tpl) => (
                  <Button
                    key={tpl.id}
                    variant="outline"
                    size="lg"
                    className={cn(
                      'bg-surface justify-start gap-3 rounded-lg px-4 py-3 text-left hover:border-primary/50 hover:bg-surface-hover',
                      hoveredTemplate === tpl.id && 'border-primary/50 bg-surface-hover',
                    )}
                    onClick={() => onSelect(tpl)}
                    onMouseEnter={() => setHoveredTemplate(tpl.id)}
                    onMouseLeave={() => setHoveredTemplate(null)}
                  >
                    <FileText className="h-5 w-5 text-text-secondary shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-text truncate">{tpl.name}</div>
                      {tpl.description && (
                        <div className="text-xs text-text-tertiary truncate">{tpl.description}</div>
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Preview pane */}
        {hoveredTpl && (
          <div className="w-80 shrink-0">
            <Card className="sticky top-4">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-medium text-text">{hoveredTpl.name}</div>
                {hoveredTpl.description && (
                  <div className="text-xs text-text-tertiary mt-0.5">{hoveredTpl.description}</div>
                )}
              </div>
              <div className="p-4 max-h-64 overflow-auto">
                <MarkdownRenderer content={hoveredTpl.body} />
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
