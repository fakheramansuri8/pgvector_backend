import { registerAs } from '@nestjs/config';
import { SequelizeModuleOptions } from '@nestjs/sequelize';

export default registerAs('database', (): SequelizeModuleOptions => {
  return {
    dialect: 'postgres',
    uri:
      process.env.DATABASE_URI ||
      'postgres://postgres:postgres@172.17.172.151:5432/pgvector_db',
    autoLoadModels: true,
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
    dialectOptions: {
      ssl: false,
    },
  };
});

