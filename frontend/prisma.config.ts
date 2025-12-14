import { defineConfig } from '@prisma/config';

export default defineConfig({

    datasource: { // singular
        url: process.env.DATABASE_URL ?? ''
    }
});
