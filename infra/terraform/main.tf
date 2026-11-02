data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "region" {
  value = data.aws_region.current.region
}


data "aws_instance" "staging" {
  instance_id = "i-0b744430a1b255207"
}

output "staging_instance" {
  value = {
    id                = data.aws_instance.staging.id
    name              = data.aws_instance.staging.tags["Name"]
    instance_type     = data.aws_instance.staging.instance_type
    availability_zone = data.aws_instance.staging.availability_zone
    subnet_id         = data.aws_instance.staging.subnet_id
    private_ip        = data.aws_instance.staging.private_ip
    public_ip         = data.aws_instance.staging.public_ip
    security_groups   = data.aws_instance.staging.vpc_security_group_ids
  }
}
