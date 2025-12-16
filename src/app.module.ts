import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import databaseConfig from './config/database.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PurchaseInvoice } from './models/PurchaseInvoice.model';
import { PurchaseInvoiceItem } from './models/PurchaseInvoiceItem.model';
import { PurchaseInvoiceController } from './controllers/purchase-invoice.controller';
import { PurchaseInvoiceService } from './services/purchase-invoice.service';
import { EmbeddingService } from './services/embedding.service';
import { SearchService } from './services/search.service';
import { QueryPreprocessingService } from './services/query-preprocessing.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<ReturnType<typeof databaseConfig>>('database');
        if (!config) {
          throw new Error('Database configuration not found');
        }
        return config;
      },
      inject: [ConfigService],
    }),
    SequelizeModule.forFeature([PurchaseInvoice, PurchaseInvoiceItem]),
  ],
  controllers: [AppController, PurchaseInvoiceController],
  providers: [AppService, PurchaseInvoiceService, EmbeddingService, SearchService, QueryPreprocessingService],
})
export class AppModule {}
