import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { BasisGateway } from './websocket/basis.gateway';
import { HistoryController } from './history/controller';

@Module({
  providers: [BasisGateway],
  controllers: [HistoryController],
})
export class AppModule {}
