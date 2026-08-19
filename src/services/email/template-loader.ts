import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';

const cache = new Map<string, HandlebarsTemplateDelegate>();

async function readTemplateFile(templateName: string): Promise<string> {
  const fromDist = path.join(__dirname, 'templates', `${templateName}.hbs`);
  const fromSrc = path.join(
    process.cwd(),
    'src',
    'services',
    'email',
    'templates',
    `${templateName}.hbs`,
  );
  const filePath = (await fs.access(fromDist).then(() => fromDist).catch(() => fromSrc));
  return fs.readFile(filePath, 'utf8');
}

export const templateLoader = {
  async ensureLayout(): Promise<void> {
    if (Handlebars.partials['layout']) return;
    const source = await readTemplateFile('layout');
    Handlebars.registerPartial('layout', Handlebars.compile(source));
  },

  async getTemplate(templateName: string): Promise<HandlebarsTemplateDelegate> {
    const cached = cache.get(templateName);
    if (cached) return cached;

    await this.ensureLayout();
    const source = await readTemplateFile(templateName);
    const compiled = Handlebars.compile(source);
    cache.set(templateName, compiled);
    return compiled;
  },
};
