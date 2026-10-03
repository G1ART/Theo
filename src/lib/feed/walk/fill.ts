/** Replace `{name}` slots. Unknown keys are left in place. */
export function fillTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : whole
  );
}
