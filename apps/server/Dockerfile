FROM node:20-alpine
WORKDIR /usr/src/app

# Copy root manifests to enable workspace install
COPY ../../package.json ../../package-lock.json* ../../pnpm-lock.yaml* ../../tsconfig.base.json /usr/src/
COPY . /usr/src/app

# Install only server workspace
RUN cd /usr/src && npm i --workspaces=false && cd /usr/src/app && npm i

RUN npm run build

EXPOSE 2567
CMD ["npm", "run", "start"]

