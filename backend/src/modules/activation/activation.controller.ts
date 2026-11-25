import { Body, Controller, Get, Post } from '@nestjs/common';
import { ActivationService } from './activation.service';
import { ActivateAppDto } from './dto/activate-app.dto';
import { InitializeAppDto } from './dto/initialize-app.dto';

@Controller(['api/activation', 'api/v1/activation'])
export class ActivationController {
  constructor(private readonly activationService: ActivationService) {}

  @Get('status')
  status() {
    return this.activationService.getStatus();
  }

  @Post('activate')
  activate(@Body() dto: ActivateAppDto) {
    return this.activationService.activate(dto);
  }

  @Post('initialize')
  initialize(@Body() dto: InitializeAppDto) {
    return this.activationService.initialize(dto);
  }
}
