import 'dotenv/config'
import { defineConfig } from '@prisma/config';

const url = process.env.DATABASE_URL;

if (!url) {
    throw new Error('DATABASE_URL is missing. Set it in .env for dev or via environment vars in production.');
}

export default defineConfig({
    datasource: {
        url
    }
});
