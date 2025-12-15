import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { PurchaseInvoiceService } from '../services/purchase-invoice.service';
import { SearchService, SearchResult } from '../services/search.service';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from '../dto/update-purchase-invoice.dto';
import { SearchPurchaseInvoiceDto } from '../dto/search-purchase-invoice.dto';

@Controller('api/purchase-invoice')
export class PurchaseInvoiceController {
  constructor(
    private readonly purchaseInvoiceService: PurchaseInvoiceService,
    private readonly searchService: SearchService,
  ) {}

  @Post()
  async create(@Body() createDto: CreatePurchaseInvoiceDto) {
    const invoice = await this.purchaseInvoiceService.create(createDto);
    await this.searchService.generateAndStoreEmbedding(invoice.id);
    return invoice;
  }

  @Get()
  async findAll(
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) {
    if (!companyId) {
      throw new BadRequestException('companyId is required');
    }
    
    const companyIdNum = parseInt(companyId, 10);
    if (isNaN(companyIdNum)) {
      throw new BadRequestException('companyId must be a valid number');
    }
    
    const branchIdNum = branchId ? parseInt(branchId, 10) : undefined;
    if (branchId && isNaN(branchIdNum!)) {
      throw new BadRequestException('branchId must be a valid number');
    }
    
    return this.purchaseInvoiceService.findAll({ 
      companyId: companyIdNum, 
      branchId: branchIdNum 
    });
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseInvoiceService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdatePurchaseInvoiceDto,
  ) {
    const invoice = await this.purchaseInvoiceService.update(id, updateDto);
    await this.searchService.generateAndStoreEmbedding(invoice.id);
    return invoice;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseInvoiceService.remove(id);
  }

  @Post('search')
  async search(@Body() searchDto: SearchPurchaseInvoiceDto): Promise<SearchResult[]> {
    return this.searchService.semanticSearch(searchDto.query, {
      companyId: searchDto.companyId,
      branchId: searchDto.branchId,
      dateFrom: searchDto.dateFrom,
      dateTo: searchDto.dateTo,
      limit: searchDto.limit,
    });
  }

  @Post(':id/generate-embedding')
  async generateEmbedding(@Param('id', ParseIntPipe) id: number) {
    await this.searchService.generateAndStoreEmbedding(id);
    return { message: 'Embedding generated successfully' };
  }
}

