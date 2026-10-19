// Déclaration minimale de « mailparser » : seul l'analyseur simple est utilisé (src/modules/sources/email/imap.ts).
declare module "mailparser" {
  export type ParsedMail = {
    from?: { value: { address?: string; name?: string }[]; text: string };
    subject?: string;
    date?: Date;
    messageId?: string;
    html: string | false;
    text?: string;
  };
  export function simpleParser(source: Buffer | string, options?: Record<string, unknown>): Promise<ParsedMail>;
}
