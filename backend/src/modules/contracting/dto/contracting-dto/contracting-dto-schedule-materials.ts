import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateScheduleTaskDto {
  @IsString()
  @IsNotEmpty()
  taskName!: string;

  @IsString()
  @IsOptional()
  taskCode?: string;

  @IsString()
  @IsOptional()
  wbsCode?: string;

  @IsString()
  @IsNotEmpty()
  startDate!: string;

  @IsString()
  @IsNotEmpty()
  endDate!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationDays?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  progressPercent?: number;

  @IsString()
  @IsOptional()
  predecessorId?: string;

  @IsOptional()
  isCriticalPath?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'completed', 'delayed'])
  status?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsOptional()
  assignedTeam?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  plannedManpowerCount?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  plannedEquipmentCount?: number;

  @IsString()
  @IsOptional()
  resourceTrade?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateScheduleTaskDto {
  @IsString()
  @IsOptional()
  taskName?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationDays?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  progressPercent?: number;

  @IsString()
  @IsOptional()
  predecessorId?: string;

  @IsOptional()
  isCriticalPath?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'completed', 'delayed'])
  status?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsOptional()
  assignedTeam?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  plannedManpowerCount?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  plannedEquipmentCount?: number;

  @IsString()
  @IsOptional()
  resourceTrade?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateMaterialRequisitionDto {
  @IsString()
  @IsOptional()
  requisitionNumber?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsNumber()
  @IsOptional()
  warehouseId?: number;

  @IsNumber()
  @IsOptional()
  productId?: number;

  @IsString()
  @IsNotEmpty()
  itemName!: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsString()
  @IsOptional()
  issueDate?: string;

  @IsString()
  @IsOptional()
  recipientName?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// ============================================================================
// Enterprise Contracting DTOs
// ============================================================================
