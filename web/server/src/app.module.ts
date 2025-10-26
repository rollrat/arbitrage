import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { BasisGateway } from './websocket/basis.gateway';

@Module({
  providers: [BasisGateway],
})
export class AppModule {}
