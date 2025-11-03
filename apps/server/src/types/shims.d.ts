declare module 'bcryptjs' {
  const mod: any;
  export default mod;
}

declare module 'unzipper' {
  const mod: any;
  export default mod;
}

declare module 'multer' {
  const multer: any;
  namespace multer {
    export interface File { fieldname: string; originalname: string; mimetype: string; size: number; buffer?: Buffer; }
  }
  export default multer;
}


// Optional proprietary tenancy module. Present only in enterprise builds.
declare module '@meetropolis/tenancy' {
  const mod: any;
  export default mod;
}


