/** word-extractor 1.0.4 no trae tipos: solo lo que se usa (documentos/leer.ts). */
declare module 'word-extractor' {
  interface Documento { getBody(): string }
  export default class WordExtractor {
    extract(fuente: Buffer | string): Promise<Documento>;
  }
}
