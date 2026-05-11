// Multer file shape kept local because the project does not depend on
// @types/multer. Matches the subset of `Express.Multer.File` actually used.

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface RequestWithMulterFile {
  file?: MulterFile;
}

export interface RequestWithMulterFields {
  files?: {
    file?: MulterFile[];
    images?: MulterFile[];
    [field: string]: MulterFile[] | undefined;
  };
}
